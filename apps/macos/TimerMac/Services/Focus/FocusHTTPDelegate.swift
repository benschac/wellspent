import Foundation

final class FocusHTTPDelegate: NSObject, URLSessionTaskDelegate, Sendable {
    // Never forward account credentials to a redirect destination.
    func urlSession(
        _ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
        completionHandler: @escaping @Sendable (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}
