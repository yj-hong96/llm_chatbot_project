// src/components/chat/VoiceChatMessages.jsx
import React, { useState, useEffect, useRef } from "react";

// ✅ 간단한 시간 포맷팅 함수
function formatTime(timestamp) {
  if (!timestamp)
    return new Date().toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  return new Date(timestamp).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ✅ 텍스트 하이라이트 컴포넌트 (형광색만 변경됨)
const HighlightedText = ({ text, charIndex }) => {
  if (charIndex === null || charIndex < 0) return <>{text}</>;

  let nextSpace = text.indexOf(" ", charIndex);
  if (nextSpace === -1) nextSpace = text.length;

  const before = text.slice(0, charIndex);
  const current = text.slice(charIndex, nextSpace);
  const after = text.slice(nextSpace);

  return (
    <span>
      {before}
      <span
        style={{
          backgroundColor: "#a3e635",
          transition: "background 0.2s",
        }}
      >
        {current}
      </span>
      {after}
    </span>
  );
};

function VoiceChatMessages({
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
  // ★ 전역 재생(Play 버튼/자동 읽기)에서 넘어오는 하이라이트 정보
  speakingMessageIndex,
  speakingCharIndex,
  onStopGlobalSpeak,
}) {
  // 🔊 이 컴포넌트 내부에서 "듣기" 눌렀을 때(부분/전체)용 로컬 TTS 상태
  const [speakingIdx, setSpeakingIdx] = useState(null);
  const [localCharIndex, setLocalCharIndex] = useState(-1);
  const [isReadingFull, setIsReadingFull] = useState(false);

  // ✨ 드래그 선택 메뉴 상태 (좌표 및 대상 메시지 인덱스)
  const [selectionMenu, setSelectionMenu] = useState(null);

  // ✨ 자동으로 읽어준 "첫 인사 메시지"를 추적 (이제 전역에서 처리하므로, ref만 유지)
  const autoSpokenMessageRef = useRef(null);

  // 컴포넌트 언마운트 시 TTS 중단
  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  // ✨ 드래그 해제 감지 (선택 취소 시 메뉴 닫기)
  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        setSelectionMenu(null);
      }
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, []);

  // 전역 재생이 시작되면(Play 버튼/자동 읽기) 로컬 TTS 상태 초기화
  useEffect(() => {
    if (speakingMessageIndex != null) {
      setSpeakingIdx(null);
      setLocalCharIndex(-1);
      setIsReadingFull(false);
    }
  }, [speakingMessageIndex]);

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

  // ✨ 텍스트 드래그 완료 시 실행 (말풍선에 연결)
  const handleTextMouseUp = (e, idx) => {
    const selection = window.getSelection();
    const text = selection.toString().trim();

    if (!text) return;

    // 현재 이벤트가 발생한 말풍선 내부의 선택인지 확인
    if (!e.currentTarget.contains(selection.anchorNode)) return;

    // 선택 영역의 좌표 계산 (화면 기준)
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // 메뉴 위치 설정 (선택 영역 중앙 상단)
    setSelectionMenu({
      x: rect.left + rect.width / 2,
      y: rect.top - 10,
      idx: idx,
    });
  };

  // ✅ TTS 함수 (이 컴포넌트 내부 "듣기" 버튼/부분 읽기용)
  const handleSpeak = (text, idx) => {
    const synth = window.speechSynthesis;

    if (!synth) {
      alert("이 브라우저는 음성 합성을 지원하지 않습니다.");
      return;
    }

    synth.cancel();
    setSpeakingIdx(null);
    setLocalCharIndex(-1);

    // 1. 드래그된 텍스트 확인
    const selection = window.getSelection();
    const selectedText = selection ? selection.toString().trim() : "";

    // 2. 읽을 텍스트 결정
    let textToRead = text;
    let full = true;

    if (selectedText && text.includes(selectedText)) {
      textToRead = selectedText;
      full = false;
    }

    setIsReadingFull(full);

    const utterance = new SpeechSynthesisUtterance(textToRead);
    utterance.rate = 1.0;
    utterance.pitch = 1.1;
    utterance.volume = 1.0;

    utterance.onstart = () => {
      setSpeakingIdx(idx);
      if (full) setLocalCharIndex(0);
    };

    // boundary 이벤트마다 현재 읽는 위치 반영
    utterance.onboundary = (event) => {
      if (!full) return;
      if (typeof event.charIndex === "number") {
        setLocalCharIndex(event.charIndex);
      }
    };

    const resetState = () => {
      setSpeakingIdx(null);
      setLocalCharIndex(-1);
      setIsReadingFull(false);
    };
    utterance.onend = resetState;
    utterance.onerror = resetState;

    let voices = synth.getVoices();
    const setKoreanVoice = () => {
      const korVoice = voices.find(
        (v) =>
          v.lang.includes("ko") ||
          v.name.includes("Korean") ||
          v.name.includes("한국어")
      );
      if (korVoice) {
        utterance.voice = korVoice;
        utterance.lang = korVoice.lang;
      } else {
        utterance.lang = "ko-KR";
      }
      synth.speak(utterance);
    };

    if (!voices || voices.length === 0) {
      synth.onvoiceschanged = () => {
        voices = synth.getVoices();
        setKoreanVoice();
      };
    } else {
      setKoreanVoice();
    }
  };

  const handleStopSpeak = () => {
    // ★ 부모(VoiceChatPage) 쪽 전역 재생 상태도 같이 리셋
    if (onStopGlobalSpeak) {
      onStopGlobalSpeak();   // 내부에서 cancel + isSpeaking 등 정리
    } else if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    // 로컬(말풍선 내부 TTS) 상태 리셋
    setSpeakingIdx(null);
    setLocalCharIndex(-1);
    setIsReadingFull(false);
  };

  const onDeleteClick = (idx) => {
    // 현재 이 메시지를 읽는 중이면 중단
    if (speakingIdx === idx || speakingMessageIndex === idx) {
      handleStopSpeak();
    }
    handleDeleteMessage(idx);
    setOpenMessageMenuIndex(null);
  };

  // (예전) VoiceChat 전용 첫 인사 자동 읽기는
  // 이제 상위(VoiceChatPage)에서 speak()로 처리하므로 여기서는 별도 동작하지 않게 둠
  useEffect(() => {
    if (!messages || messages.length === 0) return;
    const firstBot = messages.find((m) => m.role === "bot");
    if (!firstBot || !firstBot.text) return;
    autoSpokenMessageRef.current = firstBot;
  }, [messages]);

  return (
    // 스크롤 시 플로팅 메뉴 닫기 위해 onScroll 추가
    <div className="chat-messages" onScroll={() => setSelectionMenu(null)}>
      {/* ✨ 부분 읽기 플로팅 버튼 */}
      {selectionMenu && (
        <div
          className="selection-read-btn-wrapper"
          style={{
            position: "fixed",
            top: selectionMenu.y,
            left: selectionMenu.x,
            transform: "translate(-50%, -100%)",
            zIndex: 1000,
            marginTop: -8,
            animation: "fadeIn 0.2s ease-out",
          }}
        >
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              // 해당 메시지 전체 텍스트를 넘기지만, handleSpeak 내부에서 선택영역만 읽음
              handleSpeak(messages[selectionMenu.idx].text, selectionMenu.idx);
              setSelectionMenu(null);
            }}
            style={{
              backgroundColor: "#2563eb",
              color: "white",
              border: "none",
              borderRadius: "999px",
              padding: "6px 14px",
              fontSize: "13px",
              fontWeight: "500",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              whiteSpace: "nowrap",
            }}
          >
            <span>🔊</span> 해당부분만 읽기
          </button>
          <div
            style={{
              position: "absolute",
              bottom: -4,
              left: "50%",
              transform: "translateX(-50%)",
              width: 0,
              height: 0,
              borderLeft: "5px solid transparent",
              borderRight: "5px solid transparent",
              borderTop: "5px solid #2563eb",
            }}
          />
        </div>
      )}

      {messages.map((m, idx) => {
        const isBot = m.role === "bot";
        const align = isBot ? "flex-start" : "flex-end";
        const bubbleBg = isBot ? "#ffffff" : "#fee500";
        const borderColor = isBot ? "#e5e7eb" : "transparent";

        const isHovered = hoveredMessageIndex === idx;
        const isMenuOpen = openMessageMenuIndex === idx;

        const isGlobalSpeaking = speakingMessageIndex === idx;
        const isLocalSpeaking = speakingIdx === idx;
        const isAnySpeaking = isGlobalSpeaking || isLocalSpeaking;

        let displayNode;
        if (
          isGlobalSpeaking &&
          typeof speakingCharIndex === "number" &&
          speakingCharIndex >= 0
        ) {
          // 전역 재생(Play 버튼/자동 읽기) 하이라이트
          displayNode = (
            <HighlightedText text={m.text} charIndex={speakingCharIndex} />
          );
        } else if (
          isLocalSpeaking &&
          isReadingFull &&
          typeof localCharIndex === "number" &&
          localCharIndex >= 0
        ) {
          // 이 컴포넌트 내부 "듣기" 전체 읽기용 하이라이트
          displayNode = (
            <HighlightedText text={m.text} charIndex={localCharIndex} />
          );
        } else {
          displayNode = m.text;
        }

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
            {/* 아바타 */}
            {isBot && (
              <div style={{ marginRight: 8, marginTop: 0 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    background: "#e0f2fe",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 18,
                  }}
                >
                  🤖
                </div>
              </div>
            )}

            <div
              style={{
                display: "flex",
                flexDirection: isBot ? "row" : "row-reverse",
                alignItems: "flex-start",
                maxWidth: "80%",
                gap: 8,
              }}
            >
              {/* 1. 말풍선 + 시간 */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: isBot ? "flex-start" : "flex-end",
                }}
              >
                <div
                  className="chat-message-bubble-wrapper"
                  onMouseUp={(e) => handleTextMouseUp(e, idx)}
                  style={{
                    position: "relative",
                    border: `1px solid ${borderColor}`,
                    borderRadius: isBot
                      ? "4px 16px 16px 16px"
                      : "16px 4px 16px 16px",
                    padding: 2,
                    background: "#ffffff",
                    boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
                  }}
                >
                  <div
                    className="message-bubble-content"
                    style={{
                      background: bubbleBg,
                      borderRadius: isBot
                        ? "4px 14px 14px 14px"
                        : "14px 4px 14px 14px",
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
                    {displayNode}
                  </div>
                </div>

                <div
                  style={{
                    fontSize: 11,
                    color: "#9ca3af",
                    marginTop: 4,
                    marginLeft: 2,
                    marginRight: 2,
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatTime(m.createdAt || Date.now())}
                </div>
              </div>

              {/* 2. 버튼 영역 */}
              <div
                className="message-actions"
                style={{
                  position: "relative",
                  marginTop: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  opacity:
                    isHovered || isMenuOpen || isAnySpeaking ? 1 : 0,
                  transition: "opacity 0.2s ease",
                  visibility:
                    isHovered || isMenuOpen || isAnySpeaking
                      ? "visible"
                      : "hidden",
                  zIndex: 5,
                }}
              >
                {isAnySpeaking ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStopSpeak();
                    }}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      border: "1px solid #fca5a5",
                      backgroundColor: "#fef2f2",
                      color: "#ef4444",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      animation: "pulse 1.5s infinite",
                    }}
                    title="읽기 중지"
                  >
                    ⏹
                  </button>
                ) : (
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
                )}

                {isMenuOpen && !isAnySpeaking && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      [isBot ? "left" : "right"]: 0,
                      marginTop: 4,
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                      background: "#ffffff",
                      padding: 6,
                      borderRadius: 12,
                      boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                      border: "1px solid #f3f4f6",
                      zIndex: 20,
                      minWidth: 80,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isBot && (
                      <button
                        type="button"
                        onClick={() => {
                          handleSpeak(m.text, idx);
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
                        onMouseEnter={(e) =>
                          (e.target.style.background = "#f3f4f6")
                        }
                        onMouseLeave={(e) =>
                          (e.target.style.background = "transparent")
                        }
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
                      onMouseEnter={(e) =>
                        (e.target.style.background = "#f3f4f6")
                      }
                      onMouseLeave={(e) =>
                        (e.target.style.background = "transparent")
                      }
                    >
                      📄 복사
                    </button>
                    {idx !== 0 && (
                      <button
                        type="button"
                        onClick={() => onDeleteClick(idx)}
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
                        onMouseEnter={(e) =>
                          (e.target.style.background = "#fef2f2")
                        }
                        onMouseLeave={(e) =>
                          (e.target.style.background = "transparent")
                        }
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

      {isCurrentPending && (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-start",
            margin: "16px 0",
            padding: "0 8px",
          }}
        >
          <div
            style={{ marginRight: 8, alignSelf: "flex-start", marginTop: 4 }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: "#e0f2fe",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 18,
              }}
            >
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
            >
              <div
                className="loading-main-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 4,
                }}
              >
                <span
                  className="loading-title"
                  style={{
                    fontWeight: 600,
                    color: "#2563eb",
                    fontSize: "0.9rem",
                  }}
                >
                  답변 생성 중...
                </span>
                <span className="typing-dots">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </span>
              </div>
              <div
                className="loading-subtext"
                style={{ fontSize: "0.8rem", color: "#64748b" }}
              >
                {getLoadingText()}
              </div>
            </div>
          </div>
        </div>
      )}

      <div ref={messagesEndRef} />

      <style>{`
        @keyframes pulse {
          0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
          70% { transform: scale(1.05); box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
          100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translate(-50%, -90%); }
          to { opacity: 1; transform: translate(-50%, -100%); }
        }
      `}</style>
    </div>
  );
}

export default VoiceChatMessages;
