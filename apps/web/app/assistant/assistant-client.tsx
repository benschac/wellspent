"use client";

import { useChat } from "@ai-sdk/react";
import { streamAssistantChat } from "@repo/api-client";
import { useState } from "react";
import { api } from "../query-provider";

export function AssistantClient() {
  const [input, setInput] = useState("");
  const { error, messages, sendMessage, status, stop } = useChat({
    id: "focus-assistant",
    transport: {
      async sendMessages(options) {
        return streamAssistantChat(
          api,
          {
            chatId: options.chatId,
            messages: options.messages,
          },
          options.abortSignal,
        );
      },
      async reconnectToStream() {
        return null;
      },
    },
  });
  const isStreaming = status === "submitted" || status === "streaming";

  return (
    <div className="assistant-chat">
      <div aria-live="polite" className="assistant-messages">
        {messages.length === 0 ? (
          <p className="assistant-empty">
            Try “I have 30 minutes and need to prepare tomorrow’s demo.”
          </p>
        ) : null}
        {messages.map((message) => (
          <article className={`assistant-message assistant-message--${message.role}`} key={message.id}>
            <strong>{message.role === "user" ? "You" : "Coach"}</strong>
            {message.parts.map((part, index) =>
              part.type === "text" ? (
                <p key={`${message.id}-${index}`}>{part.text}</p>
              ) : null,
            )}
          </article>
        ))}
      </div>

      {error ? (
        <p className="assistant-error" role="alert">
          {error.message}
        </p>
      ) : null}

      <form
        className="assistant-form"
        onSubmit={(event) => {
          event.preventDefault();
          const message = input.trim();
          if (message.length === 0 || isStreaming) {
            return;
          }

          void sendMessage({ text: message });
          setInput("");
        }}
      >
        <label htmlFor="assistant-input">What are you working on?</label>
        <textarea
          disabled={isStreaming}
          id="assistant-input"
          maxLength={2_000}
          onChange={(event) => setInput(event.currentTarget.value)}
          placeholder="Describe the task and how much time you have…"
          rows={4}
          value={input}
        />
        <div className="assistant-actions">
          <button
            className="timer-button timer-button--primary"
            disabled={input.trim().length === 0 || isStreaming}
            type="submit"
          >
            Ask coach
          </button>
          {isStreaming ? (
            <button className="timer-button" onClick={() => stop()} type="button">
              Stop
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
