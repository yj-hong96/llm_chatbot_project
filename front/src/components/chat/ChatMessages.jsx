// src/components/chat/ChatMessages.jsx
import React from "react";

function ChatMessages({
  messages,
  isCurrentPending,
  loadingPhase,
  hoveredMessageIndex,
  setHoveredMessageIndex,
  openMessageMenuIndex,
  setOpenMessageMenuIndex,
  handleCopyMessage,
  handleDeleteMessage, // ✅ [추가] ChatPage에서 전달받은 삭제 함수
  messagesEndRef,
}) {
  const getLoadingText = () => {
    switch (loadingPhase) {
      case "understanding":
        return "질문의 의도를 파악하고 핵심 내용을 분석하고 있어요.";
      case "searching":
        return "관련 자료와 데이터를 검색해서 필요한 정보들을 모으는 중입니다.";
      case "composing":
        return "찾아낸 정보를 바탕으로 가장 이해하기 쉬운 형태로 답변을 정리하고 있어요.";
      default:
        return "질문을 이해하고, 관련 데이터를 검색한 뒤 가장 알맞은 내용을 정리하고 있습니다. 내용이 복잡할수록 더 정확한 답변을 위해 한 번 더 검토하고 있어요.";
    }
  };

  return (
    <div className="chat-messages">
      {messages.map((m, idx) => {
        const isBot = m.role === "bot";
        const align = isBot ? "flex-start" : "flex-end";
        const bubbleBg = isBot ? "#e6f4ff" : "#fee500";

        const isHovered = hoveredMessageIndex === idx;
        const isMenuOpen = openMessageMenuIndex === idx;

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
            {/* 한 줄에 말풍선 + 액션바 (봇: 오른쪽, 사용자: 왼쪽) */}
            <div
              style={{
                display: "flex",
                flexDirection: isBot ? "row" : "row-reverse",
                alignItems: "flex-start",
                maxWidth: "80%",
                gap: 8,
              }}
            >
              {/* 말풍선 */}
              <div
                className="chat-message-bubble-wrapper"
                style={{
                  position: "relative",
                  border: "1px solid var(--page-bg, #ffffff)",
                  borderRadius: 16,
                  padding: 6,
                  background: "var(--page-bg, #ffffff)",
                }}
              >
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

              {/* ⋯ / 복사 / 삭제 사이드 액션바 */}
              <div
                className="message-actions"
                style={{
                  position: "sticky",
                  top: 10, // 이 값으로 위에서부터 살짝 띄워줌
                  alignSelf: "flex-start",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  opacity: isHovered || isMenuOpen ? 1 : 0.4,
                  transition: "opacity 0.15s ease-out",
                }}
              >
                {/* 항상 보이는 … 버튼 */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMessageMenuIndex((prev) =>
                      prev === idx ? null : idx
                    );
                  }}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 999,
                    border: "none",
                    backgroundColor: "#f3f4f6",
                    boxShadow: "0 1px 3px rgba(15,23,42,0.18)",
                    cursor: "pointer",
                    fontSize: 16,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  ⋯
                </button>

                {/* … 눌렀을 때만 보이는 복사 / 삭제 */}
                {isMenuOpen && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      background: "#ffffff",
                      padding: "4px 6px",
                      borderRadius: 12,
                      boxShadow:
                        "0 12px 24px rgba(15,23,42,0.15), 0 0 0 1px rgba(148,163,184,0.25)",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        handleCopyMessage(m.text);
                        setOpenMessageMenuIndex(null);
                      }}
                      style={{
                        border: "none",
                        borderRadius: 999,
                        padding: "4px 10px",
                        background: "#e5e7eb",
                        fontSize: 13,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                        textAlign: "left",
                      }}
                    >
                      복사
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        // ✅ [수정됨] 실제 삭제 함수 호출
                        handleDeleteMessage(idx);
                        setOpenMessageMenuIndex(null);
                      }}
                      style={{
                        border: "none",
                        borderRadius: 999,
                        padding: "4px 10px",
                        background: "#fee2e2",
                        fontSize: 13,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                        textAlign: "left",
                        color: "#b91c1c",
                      }}
                    >
                      삭제
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* 로딩 카드 */}
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
              <div className="loading-subtext">{getLoadingText()}</div>
            </div>
          </div>
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}

export default ChatMessages;