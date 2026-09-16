import SwiftUI

struct RecordingReviewView: View {
    let recording: RecordingSnapshot

    var body: some View {
        ScrollView {
            RecordingReviewContent(recording: recording).padding(20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.background.opacity(0.45), in: RoundedRectangle(cornerRadius: 12))
        .id(recording.id)
    }
}
