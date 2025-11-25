// src/components/chat/ChatMessages.jsx
import React from "react";

// ✅ 간단한 시간 포맷팅 함수
function formatTime(timestamp) {
  if (!timestamp) return new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  return new Date(timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function ChatMessages({
  messages,
  isCurrentPending,
  loadingPhase,
  hoveredMessageIndex,
  setHoveredMessageIndex,
  openMessageMenuIndex,
  setOpenMessageMenuIndex,
  handleCopyMessage,
  handleDeleteMessage,
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
        return "질문을 이해하고, 관련 데이터를 검색한 뒤 가장 알맞은 내용을 정리하고 있습니다.";
    }
  };

  // ✅ [수정됨] TTS (음성 듣기) 함수 : 한국어 음성 강제 찾기 적용
  const handleSpeak = (text) => {
    const synth = window.speechSynthesis;

    if (!synth) {
      alert("이 브라우저는 음성 합성을 지원하지 않습니다.");
      return;
    }

    // 기존 음성 중단 (겹침 방지)
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1; // 속도
    utterance.pitch = 1.2; // 톤
    utterance.volume = 1.0; // 볼륨

    // 1. 사용 가능한 음성 목록 가져오기
    let voices = synth.getVoices();

    // 2. 한국어 음성 찾기 함수
    const setKoreanVoice = () => {
      // 'ko-KR', 'ko_KR', 'Korean' 등이 포함된 음성 찾기 (구글 한국어, MS 한국어 등)
      const korVoice = voices.find(
        (v) => v.lang.includes("ko") || v.name.includes("Korean") || v.name.includes("한국어")
      );

      // 한국어 음성이 있으면 설정
      if (korVoice) {
        utterance.voice = korVoice;
        utterance.lang = korVoice.lang;
      } else {
        // 없으면 lang만이라도 설정 (OS 기본값 시도)
        utterance.lang = "ko-KR";
        console.warn("한국어 음성 팩을 찾을 수 없어 기본 설정으로 시도합니다.");
      }

      synth.speak(utterance);
    };

    // 3. 음성 목록이 아직 안 로드되었을 경우 (Chrome 이슈 대응)
    if (voices.length === 0) {
      synth.onvoiceschanged = () => {
        voices = synth.getVoices();
        setKoreanVoice();
      };
    } else {
      setKoreanVoice();
    }
  };

  return (
    <div className="chat-messages">
      {messages.map((m, idx) => {
        const isBot = m.role === "bot";
        const align = isBot ? "flex-start" : "flex-end";
        const bubbleBg = isBot ? "#ffffff" : "#fee500"; 
        const borderColor = isBot ? "#e5e7eb" : "transparent";

        const isHovered = hoveredMessageIndex === idx;
        const isMenuOpen = openMessageMenuIndex === idx;

        return (
          <div
            key={idx}
            style={{
              display: "flex",
              justifyContent: align,
              margin: "16px 0",
              padding: "0 8px",
            }}
            onMouseEnter={() => setHoveredMessageIndex(idx)}
            onMouseLeave={() => {
              setHoveredMessageIndex((prev) => (prev === idx ? null : prev));
              setOpenMessageMenuIndex((prev) => (prev === idx ? null : prev));
            }}
          >
            {/* 아바타 (프로필 아이콘) 영역 */}
            {isBot && (
              <div style={{ marginRight: 8, alignSelf: "flex-start", marginTop: 4 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: "50%",
                  background: "#e0f2fe", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 18
                }}>
                  🤖
                </div>
              </div>
            )}

            {/* 말풍선 + 액션바 + 시간 래퍼 */}
            <div
              style={{
                display: "flex",
                flexDirection: isBot ? "row" : "row-reverse",
                alignItems: "flex-end",
                maxWidth: "80%",
                gap: 8,
              }}
            >
              {/* 말풍선 */}
              <div
                className="chat-message-bubble-wrapper"
                style={{
                  position: "relative",
                  border: `1px solid ${borderColor}`,
                  borderRadius: isBot ? "4px 16px 16px 16px" : "16px 4px 16px 16px",
                  padding: 2,
                  background: "#ffffff",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
                }}
              >
                <div
                  className="message-bubble-content"
                  style={{
                    background: bubbleBg,
                    borderRadius: isBot ? "4px 14px 14px 14px" : "14px 4px 14px 14px",
                    padding: "12px 16px",
                    maxWidth: "100%",
                    width: "fit-content",
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontSize: "0.95rem",
                    color: "#1f2937",
                  }}
                >
                  {m.text}
                </div>
              </div>

              {/* 시간 표시 */}
              <div style={{ 
                fontSize: 11, 
                color: "#9ca3af", 
                marginBottom: 2, 
                whiteSpace: "nowrap" 
              }}>
                {formatTime(m.createdAt || Date.now())}
              </div>

              {/* ⋯ / 복사 / 삭제 / 듣기 사이드 액션바 */}
              <div
                className="message-actions"
                style={{
                  position: "relative", 
                  marginBottom: 8,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  opacity: isHovered || isMenuOpen ? 1 : 0,
                  transition: "opacity 0.2s ease",
                  visibility: isHovered || isMenuOpen ? "visible" : "hidden",
                }}
              >
                {/* 메뉴 트리거 버튼 */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMessageMenuIndex((prev) =>
                      prev === idx ? null : idx
                    );
                  }}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    border: "1px solid #e5e7eb",
                    backgroundColor: "#ffffff",
                    color: "#6b7280",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 14,
                  }}
                  title="더보기"
                >
                  ⋯
                </button>

                {/* 메뉴 팝업 */}
                {isMenuOpen && (
                  <div
                    style={{
                      position: "absolute",
                      [isBot ? "left" : "right"]: 0,
                      bottom: 32,
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                      background: "#ffffff",
                      padding: 6,
                      borderRadius: 12,
                      boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                      border: "1px solid #f3f4f6",
                      zIndex: 10,
                      minWidth: 80,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* 듣기 버튼 (봇 메시지만) */}
                    {isBot && (
                      <button
                        type="button"
                        onClick={() => {
                          handleSpeak(m.text);
                          setOpenMessageMenuIndex(null);
                        }}
                        style={{
                          border: "none",
                          borderRadius: 6,
                          padding: "6px 10px",
                          background: "transparent",
                          fontSize: 13,
                          cursor: "pointer",
                          textAlign: "left",
                          color: "#374151",
                        }}
                        onMouseEnter={(e) => e.target.style.background = "#f3f4f6"}
                        onMouseLeave={(e) => e.target.style.background = "transparent"}
                      >
                        🔊 듣기
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        handleCopyMessage(m.text);
                        setOpenMessageMenuIndex(null);
                      }}
                      style={{
                        border: "none",
                        borderRadius: 6,
                        padding: "6px 10px",
                        background: "transparent",
                        fontSize: 13,
                        cursor: "pointer",
                        textAlign: "left",
                        color: "#374151",
                      }}
                      onMouseEnter={(e) => e.target.style.background = "#f3f4f6"}
                      onMouseLeave={(e) => e.target.style.background = "transparent"}
                    >
                      📄 복사
                    </button>

                    {/* 첫 번째 메시지가 아닐 때만 삭제 버튼 표시 */}
                    {idx !== 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          handleDeleteMessage(idx);
                          setOpenMessageMenuIndex(null);
                        }}
                        style={{
                          border: "none",
                          borderRadius: 6,
                          padding: "6px 10px",
                          background: "transparent",
                          fontSize: 13,
                          cursor: "pointer",
                          textAlign: "left",
                          color: "#ef4444",
                        }}
                        onMouseEnter={(e) => e.target.style.background = "#fef2f2"}
                        onMouseLeave={(e) => e.target.style.background = "transparent"}
                      >
                        🗑 삭제
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* 로딩 상태 표시 (봇 아바타 포함) */}
      {isCurrentPending && (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-start",
            margin: "16px 0",
            padding: "0 8px",
          }}
        >
          <div style={{ marginRight: 8, alignSelf: "flex-start", marginTop: 4 }}>
            <div style={{
              width: 36, height: 36, borderRadius: "50%",
              background: "#e0f2fe", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18
            }}>
              🤖
            </div>
          </div>

          <div
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: "4px 16px 16px 16px",
              padding: 4,
              maxWidth: "80%",
              background: "#ffffff",
              boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
            }}
          >
            <div
              style={{
                background: "#f8fafc",
                borderRadius: "4px 14px 14px 14px",
                padding: "12px 16px",
                lineHeight: 1.5,
              }}
              className="loading-message"
            >
              <div className="loading-main-row" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span className="loading-title" style={{ fontWeight: 600, color: "#2563eb", fontSize: "0.9rem" }}>
                  답변 생성 중...
                </span>
                <span className="typing-dots">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </span>
              </div>
              <div className="loading-subtext" style={{ fontSize: "0.8rem", color: "#64748b" }}>
                {getLoadingText()}
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