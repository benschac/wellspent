import SwiftUI

struct RecordingReviewView: View {
    let recording: RecordingSnapshot

    var body: some View {
        ScrollView { RecordingReviewContent(recording: recording) }
    }
}
