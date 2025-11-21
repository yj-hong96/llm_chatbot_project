// src/components/chat/ChatMessages.jsx
import React from "react";

function ChatMessages({
  messages,
  isCurrentPending,
  hoveredMessageIndex,
  setHoveredMessageIndex,
  openMessageMenuIndex,
  setOpenMessageMenuIndex,
  handleCopyMessage,
  messagesEndRef,
}) {
  return (
    <div className="chat-messages">
      {messages.map((m, idx) => {
        const isBot = m.role === "bot";
        const align = isBot ? "flex-start" : "flex-end";
        const bubbleBg = isBot ? "#e6f4ff" : "#fee500";

        const isMenuOpen = openMessageMenuIndex === idx;
        const isHovered = hoveredMessageIndex === idx;

        return (
          <div
            key={idx}
            style={{
              display: "flex",
              justifyContent: align,
              margin: "14px 0",
            }}
            onMouseEnter={() => setHoveredMessageIndex(idx)}
            onMouseLeave={() => {
              setHoveredMessageIndex((prev) => (prev === idx ? null : prev));
              setOpenMessageMenuIndex((prev) => (prev === idx ? null : prev));
            }}
          >
            <div
              className="chat-message-bubble-wrapper"
              style={{
                position: "relative",
                border: "1px solid var(--page-bg, #ffffff)",
                borderRadius: 16,
                padding: 6,
                maxWidth: "80%",
                background: "var(--page-bg, #ffffff)",
              }}
            >
              {isBot && (
                <div className="message-menu-wrapper">
                  <span
                    className="message-more-label"
                    style={{
                      opacity: isHovered || isMenuOpen ? 1 : 0,
                      transform:
                        isHovered || isMenuOpen
                          ? "translateY(0)"
                          : "translateY(4px)",
                      pointerEvents: "none",
                    }}
                  >
                    더 보기
                  </span>

                  <button
                    type="button"
                    className="message-menu-trigger"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMessageMenuIndex((prev) =>
                        prev === idx ? null : idx
                      );
                    }}
                    style={{
                      opacity: isHovered || isMenuOpen ? 1 : 0,
                      pointerEvents:
                        isHovered || isMenuOpen ? "auto" : "none",
                    }}
                  >
                    ⋯
                  </button>
                </div>
              )}

              {isBot && isMenuOpen && (
                <div
                  className="message-menu"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className="message-menu-item"
                    onClick={() => {
                      handleCopyMessage(m.text);
                      setOpenMessageMenuIndex(null);
                    }}
                  >
                    복사
                  </button>
                </div>
              )}

              <div
                className="message-bubble-content"
                style={{
                  background: bubbleBg,
                  borderRadius: 16,
                  padding: "10px 12px",
                  maxWidth: "100%",
                  width: "fit-content",
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  boxShadow: "0 1px 0 rgba(0,0,0,0.04)",
                }}
              >
                {m.text}
              </div>
            </div>
          </div>
        );
      })}

      {/* 메인 영역: 챗봇 응답 대기중일 때 로딩 카드 */}
      {isCurrentPending && (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-start",
            margin: "14px 0",
          }}
        >
          <div
            style={{
              border: "1px solid var(--page-bg, #ffffff)",
              borderRadius: 16,
              padding: 6,
              maxWidth: "80%",
              background: "var(--page-bg, #ffffff)",
            }}
          >
            <div
              style={{
                background: "#e6f4ff",
                borderRadius: 16,
                padding: "10px 12px",
                lineHeight: 1.5,
              }}
              className="loading-message"
            >
              <div className="loading-main-row">
                <span className="loading-title">
                  챗봇이 답변을 준비하고 있어요
                </span>
                <span className="typing-dots">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </span>
              </div>
              <div className="loading-subtext">
                질문을 이해하고, 관련 데이터를 검색한 뒤 가장 알맞은 내용을
                정리하고 있습니다.
              </div>
            </div>
          </div>
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}

export default ChatMessages;
