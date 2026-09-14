import CryptoKit
import Foundation

// Only disposable synthetic bytes; does not link or launch Timer, access transcripts, or open recording storage.
@main
struct LoopbackProbe {
  struct Packet: Codable {
    let body: Data
    let mac: Data
  }
  enum Failure: Error { case invalid }
  static func main() async throws {
    guard CommandLine.arguments.count == 3,
      let port = Int(CommandLine.arguments[1]), (1024...65535).contains(port),
      let keyData = Data(base64Encoded: CommandLine.arguments[2]), keyData.count == 32,
      let url = URL(string: "http://127.0.0.1:\(port)/v1/poll")
    else { throw Failure.invalid }
    let key = SymmetricKey(data: keyData)
    let body = Data("synthetic-poll".utf8)
    let mac = Data(
      HMAC<SHA256>.authenticationCode(for: Data("wellspent-c3a-poll\0".utf8) + body, using: key))
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.httpBody = try JSONEncoder().encode(Packet(body: body, mac: mac))
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 5
    configuration.connectionProxyDictionary = [:]
    let session = URLSession(
      configuration: configuration, delegate: NoRedirect(), delegateQueue: nil)
    defer { session.invalidateAndCancel() }
    let (data, response) = try await session.data(for: request)
    guard (response as? HTTPURLResponse)?.statusCode == 200, data.count <= 16384 else {
      throw Failure.invalid
    }
    let packet = try JSONDecoder().decode(Packet.self, from: data)
    guard
      HMAC<SHA256>.isValidAuthenticationCode(
        packet.mac, authenticating: Data("wellspent-c3a-event\0".utf8) + packet.body, using: key)
    else { throw Failure.invalid }
    let container = FileManager.default.homeDirectoryForCurrentUser.path.contains("/Containers/")
    guard container else { throw Failure.invalid }
    print("PASS sandbox container + outbound authenticated loopback pull; synthetic bytes only")
  }
}

final class NoRedirect: NSObject, URLSessionTaskDelegate {
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void
  ) { completionHandler(nil) }
}
