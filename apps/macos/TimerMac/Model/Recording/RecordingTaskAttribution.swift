import Foundation

/// Local identity, independent of recordings, repositories and agent threads.
struct LocalTask: Codable, Equatable, Sendable, Identifiable {
    let id: UUID
    let localScopeID: String
    let title: String
    let createdAt: Date
    let creationCommandID: UUID

    init(
        id: UUID = UUID(), localScopeID: String, title: String, createdAt: Date,
        creationCommandID: UUID = UUID()
    ) {
        self.id = id
        self.localScopeID = localScopeID
        self.title = title
        self.createdAt = createdAt
        self.creationCommandID = creationCommandID
    }

    func validate() throws {
        guard !localScopeID.isEmpty, localScopeID.utf8.count <= 200,
            !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            title.utf8.count <= 500, createdAt.timeIntervalSince1970.isFinite
        else { throw RecordingAttributionError.invalidCommand }
    }
}

enum RecordingTaskAssignment: Codable, Equatable, Sendable {
    /// Restore the original selection-boundary projection; never infer agent or note associations.
    case automatic
    case unassigned
    case task(UUID)

    var taskID: UUID? {
        if case .task(let id) = self { return id }
        return nil
    }
}

struct RecordingTaskSelection: Codable, Equatable, Sendable, Identifiable {
    let id: UUID
    let localScopeID: String
    let recordingID: UUID
    let intervalID: UUID
    let taskID: UUID?
    let stamp: RecordingEvent.Stamp
    let expectedHeadID: UUID?
    let author: String
    var commitOrder: Int64

    init(
        id: UUID = UUID(), localScopeID: String, recordingID: UUID, intervalID: UUID,
        taskID: UUID?, stamp: RecordingEvent.Stamp, expectedHeadID: UUID? = nil,
        author: String = "local-user", commitOrder: Int64 = 0
    ) {
        self.id = id
        self.localScopeID = localScopeID
        self.recordingID = recordingID
        self.intervalID = intervalID
        self.taskID = taskID
        self.stamp = stamp
        self.expectedHeadID = expectedHeadID
        self.author = author
        self.commitOrder = commitOrder
    }
}

struct RecordingAttributionCommand: Codable, Equatable, Sendable, Identifiable {
    let id: UUID
    let localScopeID: String
    let recordingID: UUID
    let eventID: UUID
    let expectedHeadID: UUID?
    let assignment: RecordingTaskAssignment
    let createdAt: Date
    let author: String
    let undoesOperationID: UUID?
    let schemaVersion: Int

    init(
        id: UUID = UUID(), localScopeID: String, recordingID: UUID, eventID: UUID,
        expectedHeadID: UUID? = nil, assignment: RecordingTaskAssignment, createdAt: Date,
        author: String = "local-user", undoesOperationID: UUID? = nil, schemaVersion: Int = 1
    ) {
        self.id = id
        self.localScopeID = localScopeID
        self.recordingID = recordingID
        self.eventID = eventID
        self.expectedHeadID = expectedHeadID
        self.assignment = assignment
        self.createdAt = createdAt
        self.author = author
        self.undoesOperationID = undoesOperationID
        self.schemaVersion = schemaVersion
    }
}

struct RecordingAttributionOperation: Codable, Equatable, Sendable, Identifiable {
    let command: RecordingAttributionCommand
    let commitOrder: Int64
    var id: UUID { command.id }
}

enum RecordingAttributionError: Error, LocalizedError, Equatable {
    case invalidCommand
    case invalidTarget
    case conflictingIdentity
    case staleHead(currentHeadID: UUID?)
    case invalidBoundary

    var errorDescription: String? {
        switch self {
        case .invalidCommand: "This task change is invalid."
        case .invalidTarget: "The task or evidence is no longer available in this local scope."
        case .conflictingIdentity:
            "This command ID was already saved with different content. Reload before trying again."
        case .staleHead: "This attribution changed since it was opened. Reload and review the latest change."
        case .invalidBoundary: "Task switching requires the current recording interval and a new forward boundary."
        }
    }
}

/// Rebuildable projection; the ledger and original observations remain separate.
struct RecordingTaskAttribution: Equatable, Sendable {
    let tasks: [LocalTask]
    let selections: [RecordingTaskSelection]
    let operations: [RecordingAttributionOperation]

    init(
        tasks: [LocalTask] = [], selections: [RecordingTaskSelection] = [],
        operations: [RecordingAttributionOperation] = []
    ) {
        self.tasks = tasks
        self.selections = selections.sorted { $0.commitOrder < $1.commitOrder }
        self.operations = operations.sorted { $0.commitOrder < $1.commitOrder }
    }

    func head(eventID: UUID) -> RecordingAttributionOperation? {
        operations.last { $0.command.eventID == eventID }
    }

    func selectionHead(recordingID: UUID, intervalID: UUID) -> RecordingTaskSelection? {
        selections.last { $0.recordingID == recordingID && $0.intervalID == intervalID }
    }

    func selectedTaskID(recordingID: UUID, intervalID: UUID) -> UUID? {
        selectionHead(recordingID: recordingID, intervalID: intervalID)?.taskID
    }

    func assignment(for event: RecordingEvent) -> RecordingTaskAssignment {
        head(eventID: event.id)?.command.assignment ?? .automatic
    }

    /// The activation-point assignment only. A foreground span can contain later task switches.
    func taskID(for event: RecordingEvent) -> UUID? {
        switch assignment(for: event) {
        case .task(let id): return id
        case .unassigned: return nil
        case .automatic:
            guard event.kind == .application else { return nil }
            return selections.last {
                $0.recordingID == event.recordingID && $0.intervalID == event.intervalID
                    && $0.stamp.processID == event.stamp.processID && $0.stamp.uptime <= event.stamp.uptime
            }?.taskID
        }
    }

    func undoCommand(for operation: RecordingAttributionOperation, at date: Date) -> RecordingAttributionCommand {
        let previous = operations.last {
            $0.command.eventID == operation.command.eventID && $0.commitOrder < operation.commitOrder
        }
        return RecordingAttributionCommand(
            localScopeID: operation.command.localScopeID, recordingID: operation.command.recordingID,
            eventID: operation.command.eventID, expectedHeadID: operation.id,
            assignment: previous?.command.assignment ?? .automatic, createdAt: date,
            undoesOperationID: operation.id)
    }

    struct ForegroundSegment: Equatable, Sendable, Identifiable {
        struct ID: Hashable, Sendable {
            let eventID: UUID
            let boundaryID: UUID?
        }
        let id: ID
        let start: RecordingEvent.Stamp
        let end: RecordingEvent.Stamp?
        let taskID: UUID?
        var duration: TimeInterval? {
            guard let end, end.processID == start.processID, end.uptime >= start.uptime else { return nil }
            return end.uptime - start.uptime
        }
    }

    /// Half-open segments use monotonic stamps; an unknown crash end is never extended to reopen.
    func foregroundSegments(for event: RecordingEvent, in recording: RecordingSnapshot) -> [ForegroundSegment] {
        guard event.kind == .application,
            let interval = recording.intervals.first(where: { $0.id == event.intervalID })
        else { return [] }
        guard let eventIndex = recording.events.firstIndex(where: { $0.id == event.id }) else { return [] }
        let next = recording.events.enumerated().filter { index, candidate in
            candidate.kind == .application && candidate.intervalID == event.intervalID
                && candidate.stamp.processID == event.stamp.processID
                && (candidate.stamp.uptime > event.stamp.uptime
                    || (candidate.stamp.uptime == event.stamp.uptime && index > eventIndex))
        }.min { lhs, rhs in
            if lhs.element.stamp.uptime != rhs.element.stamp.uptime {
                return lhs.element.stamp.uptime < rhs.element.stamp.uptime
            }
            return lhs.offset < rhs.offset
        }?.element
        let end = next?.stamp ?? interval.end
        let assignment = assignment(for: event)
        guard assignment == .automatic else {
            return [
                .init(
                    id: .init(eventID: event.id, boundaryID: nil), start: event.stamp,
                    end: end, taskID: assignment.taskID)
            ]
        }
        let boundaries = selections.filter {
            $0.recordingID == recording.id && $0.intervalID == interval.id
                && $0.stamp.processID == event.stamp.processID && $0.stamp.uptime > event.stamp.uptime
                && (end == nil || $0.stamp.uptime < (end?.uptime ?? 0))
        }
        var result: [ForegroundSegment] = []
        var start = event.stamp
        var taskID = taskID(for: event)
        var boundaryID: UUID?
        for boundary in boundaries {
            result.append(
                .init(
                    id: .init(eventID: event.id, boundaryID: boundaryID), start: start,
                    end: boundary.stamp, taskID: taskID))
            start = boundary.stamp
            taskID = boundary.taskID
            boundaryID = boundary.id
        }
        result.append(
            .init(id: .init(eventID: event.id, boundaryID: boundaryID), start: start, end: end, taskID: taskID))
        return result
    }
}
