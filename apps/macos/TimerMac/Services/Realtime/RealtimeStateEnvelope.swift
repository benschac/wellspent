struct RealtimeStateEnvelope: Decodable {
    let event: String
    let data: RealtimeTimerState
}
