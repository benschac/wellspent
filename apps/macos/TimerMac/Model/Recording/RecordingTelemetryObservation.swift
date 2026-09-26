import Foundation

/// A read projection of an immutable body and its original committed receipt.
struct RecordingTelemetryObservation: Equatable, Identifiable, Sendable {
    let metadata: CodexTelemetryContract.Metadata
    let receipt: CodexTelemetryContract.Receipt
    let sourceWrittenAt: Date
    let nativeReceivedAt: Date
    var id: UUID { metadata.observationID }

    init(body: Data, receipt: Data) throws {
        metadata = try CodexTelemetryContract.parse(body)
        self.receipt = try JSONDecoder().decode(CodexTelemetryContract.Receipt.self, from: receipt)
        guard self.receipt.observationID == metadata.observationID,
            self.receipt.bodyDigest == CodexIntakeContract.digest(body)
        else { throw RecordingError.invalidStore }
        sourceWrittenAt = try CodexIntakeContract.date(metadata.sourceWrittenAt)
        nativeReceivedAt = try CodexIntakeContract.date(self.receipt.nativeReceivedAt)
    }
}

/// Process-only preview of an authenticated helper packet; never a native receipt or ACK.
struct PendingCodexTelemetryObservation: Equatable, Identifiable, Sendable {
    let metadata: CodexTelemetryContract.Metadata
    let exactBody: Data
    let sourceWrittenAt: Date
    var id: UUID { metadata.observationID }

    init(
        packet: CodexIntakeContract.Packet, grant: CodexIntakeContract.Grant,
        intervalStart: Date, now: Date
    ) throws {
        metadata = try CodexTelemetryContract.decode(packet, grant: grant)
        exactBody = packet.body
        sourceWrittenAt = try CodexIntakeContract.date(metadata.sourceWrittenAt)
        let helperReceivedAt = try CodexIntakeContract.date(metadata.helperReceivedAt)
        guard now <= grant.acceptUntil else { throw CodexTelemetryContract.Failure.expiredBinding }
        guard grant.issuedAt >= intervalStart, sourceWrittenAt >= grant.issuedAt,
            helperReceivedAt >= sourceWrittenAt, helperReceivedAt <= now
        else { throw CodexTelemetryContract.Failure.outsideInterval }
    }
}
