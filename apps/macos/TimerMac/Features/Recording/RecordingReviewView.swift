import SwiftUI

struct RecordingReviewView: View {
    let recording: RecordingSnapshot

    var body: some View {
        ScrollView {
            RecordingReviewContent(recording: recording).padding(24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .textBackgroundColor), in: RoundedRectangle(cornerRadius: 12))
        .overlay {
            RoundedRectangle(cornerRadius: 12).strokeBorder(.separator.opacity(0.5))
        }
        .id(recording.id)
    }
}
