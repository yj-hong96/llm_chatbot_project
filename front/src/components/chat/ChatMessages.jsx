// src/components/chat/ChatMessages.jsx
import React, { useState, useEffect } from "react";

// ✅ 간단한 시간 포맷팅 함수
function formatTime(timestamp) {
  if (!timestamp) return new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  return new Date(timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

// ✅ 텍스트 하이라이트 컴포넌트
const HighlightedText = ({ text, charIndex }) => {
  if (charIndex === null || charIndex < 0) return <>{text}</>;

  let nextSpace = text.indexOf(' ', charIndex);
  if (nextSpace === -1) nextSpace = text.length;

  const before = text.slice(0, charIndex);
  const current = text.slice(charIndex, nextSpace);
  const after = text.slice(nextSpace);

  return (
    <span>
      {before}
      <span style={{ backgroundColor: "#fde047", transition: "background 0.2s" }}>{current}</span>
      {after}
    </span>
  );
};

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
  // 🔊 현재 읽고 있는 메시지의 인덱스
  const [speakingIdx, setSpeakingIdx] = useState(null);
  // 🖍️ 현재 읽고 있는 글자의 위치
  const [charIndex, setCharIndex] = useState(-1);
  // 🔍 전체 읽기 모드 여부
  const [isReadingFull, setIsReadingFull] = useState(false);
  // ⏸️ [추가] 일시정지 상태 여부
  const [isPaused, setIsPaused] = useState(false);
  
  // ✨ 드래그 선택 메뉴 상태 (좌표 및 대상 메시지 인덱스)
  const [selectionMenu, setSelectionMenu] = useState(null);

  // 컴포넌트 언마운트 시 중단
  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  // ✨ 드래그 해제 감지 (선택 취소 시 메뉴 닫기)
  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      // 선택 영역이 없거나 접혀있으면(커서만 있을 때) 메뉴 닫기
      if (!selection || selection.isCollapsed) {
        setSelectionMenu(null);
      }
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, []);

  const getLoadingText = () => {
    switch (loadingPhase) {
      case "understanding": return "질문의 의도를 파악하고 핵심 내용을 분석하고 있어요.";
      case "searching": return "관련 자료와 데이터를 검색해서 필요한 정보들을 모으는 중입니다.";
      case "composing": return "찾아낸 정보를 바탕으로 가장 이해하기 쉬운 형태로 답변을 정리하고 있어요.";
      default: return "질문을 이해하고, 관련 데이터를 검색한 뒤 가장 알맞은 내용을 정리하고 있습니다.";
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
      idx: idx
    });
  };

  // ✅ TTS 함수
  const handleSpeak = (text, idx) => {
    const synth = window.speechSynthesis;

    if (!synth) {
      alert("이 브라우저는 음성 합성을 지원하지 않습니다.");
      return;
    }

    synth.cancel();
    setSpeakingIdx(null);
    setCharIndex(-1);
    setIsPaused(false); // 새로 시작하면 일시정지 해제

    // 1. 드래그된 텍스트 확인
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    // 2. 읽을 텍스트 결정
    let textToRead = text;
    let isFull = true;

    if (selectedText && text.includes(selectedText)) {
      textToRead = selectedText;
      isFull = false;
    }

    setIsReadingFull(isFull);

    const utterance = new SpeechSynthesisUtterance(textToRead);
    utterance.rate = 1.0;
    utterance.pitch = 1.1;
    utterance.volume = 1.0;

    utterance.onstart = () => {
      setSpeakingIdx(idx);
      if (isFull) setCharIndex(0);
      setIsPaused(false);
    };

    utterance.onboundary = (event) => {
      if (isFull && (event.name === 'word' || event.name === 'sentence')) {
        setCharIndex(event.charIndex);
      }
    };

    const resetState = () => {
      setSpeakingIdx(null);
      setCharIndex(-1);
      setIsReadingFull(false);
      setIsPaused(false);
    };
    utterance.onend = resetState;
    utterance.onerror = resetState;

    let voices = synth.getVoices();
    const setKoreanVoice = () => {
      const korVoice = voices.find(
        (v) => v.lang.includes("ko") || v.name.includes("Korean") || v.name.includes("한국어")
      );
      if (korVoice) {
        utterance.voice = korVoice;
        utterance.lang = korVoice.lang;
      } else {
        utterance.lang = "ko-KR";
      }
      synth.speak(utterance);
    };

    if (voices.length === 0) {
      synth.onvoiceschanged = () => {
        voices = synth.getVoices();
        setKoreanVoice();
      };
    } else {
      setKoreanVoice();
    }
  };

  // ✅ [수정] 토글 기능 (일시정지 <-> 재생)
  const handleTogglePause = (e) => {
    e.stopPropagation();
    const synth = window.speechSynthesis;

    if (synth.paused) {
      synth.resume();
      setIsPaused(false);
    } else {
      synth.pause();
      setIsPaused(true);
    }
  };

  // 완전 중지
  const handleStopSpeak = () => {
    window.speechSynthesis.cancel();
    setSpeakingIdx(null);
    setCharIndex(-1);
    setIsPaused(false);
  };

  const onDeleteClick = (idx) => {
    if (speakingIdx === idx) {
      handleStopSpeak();
    }
    handleDeleteMessage(idx);
    setOpenMessageMenuIndex(null);
  };

  return (
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
          <div style={{
            position: "absolute",
            bottom: -4,
            left: "50%",
            transform: "translateX(-50%)",
            width: 0, 
            height: 0, 
            borderLeft: "5px solid transparent",
            borderRight: "5px solid transparent",
            borderTop: "5px solid #2563eb",
          }} />
        </div>
      )}

      {messages.map((m, idx) => {
        const isBot = m.role === "bot";
        const align = isBot ? "flex-start" : "flex-end";
        const bubbleBg = isBot ? "#ffffff" : "#fee500"; 
        const borderColor = isBot ? "#e5e7eb" : "transparent";

        const isHovered = hoveredMessageIndex === idx;
        const isMenuOpen = openMessageMenuIndex === idx;
        const isSpeakingThis = speakingIdx === idx;

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
                <div style={{
                  width: 36, height: 36, borderRadius: "50%",
                  background: "#e0f2fe", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 18
                }}>
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
              <div style={{ display: "flex", flexDirection: "column", alignItems: isBot ? "flex-start" : "flex-end" }}>
                <div
                  className="chat-message-bubble-wrapper"
                  onMouseUp={(e) => handleTextMouseUp(e, idx)}
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
                    {isSpeakingThis && isReadingFull ? (
                      <HighlightedText text={m.text} charIndex={charIndex} />
                    ) : (
                      m.text
                    )}
                  </div>
                </div>

                <div style={{ 
                  fontSize: 11, color: "#9ca3af", marginTop: 4, marginLeft: 2, marginRight: 2, whiteSpace: "nowrap" 
                }}>
                  {formatTime(m.createdAt || Date.now())}
                </div>
              </div>

              {/* 2. 버튼 영역 (재생 컨트롤 + 더보기) */}
              <div
                className="message-actions"
                style={{
                  position: "relative", 
                  marginTop: 0,
                  display: "flex",
                  flexDirection: "row", // ✨ 버튼들을 가로로 배치
                  alignItems: "center",
                  gap: 4,
                  opacity: isHovered || isMenuOpen || isSpeakingThis ? 1 : 0,
                  transition: "opacity 0.2s ease",
                  visibility: isHovered || isMenuOpen || isSpeakingThis ? "visible" : "hidden",
                  zIndex: 5,
                }}
              >
                {/* ✨ 재생/일시정지 버튼 (읽는 중일 때만 표시) */}
                {isSpeakingThis && (
                  <button
                    type="button"
                    onClick={handleTogglePause}
                    style={{
                      width: 28, height: 28, borderRadius: "50%", border: "1px solid #fca5a5",
                      backgroundColor: isPaused ? "#fff" : "#fef2f2", 
                      color: "#ef4444", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12,
                      // 일시정지 아닐 때만 펄스 애니메이션
                      animation: isPaused ? "none" : "pulse 1.5s infinite",
                    }}
                    title={isPaused ? "다시 듣기" : "일시 정지"}
                  >
                    {isPaused ? "▶" : "⏸"}
                  </button>
                )}

                {/* ✨ 더보기 버튼 (항상 표시, 듣기 중일 땐 우측에 위치) */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMessageMenuIndex((prev) => prev === idx ? null : idx);
                  }}
                  style={{
                    width: 28, height: 28, borderRadius: "50%", border: "1px solid #e5e7eb",
                    backgroundColor: "#ffffff", color: "#6b7280", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
                  }}
                  title="더보기"
                >
                  ⋯
                </button>

                {/* 더보기 메뉴 드롭다운 */}
                {isMenuOpen && (
                  <div
                    style={{
                      position: "absolute", top: "100%", [isBot ? "left" : "right"]: 0,
                      marginTop: 4, display: "flex", flexDirection: "column", gap: 2,
                      background: "#ffffff", padding: 6, borderRadius: 12,
                      boxShadow: "0 4px 12px rgba(0,0,0,0.15)", border: "1px solid #f3f4f6",
                      zIndex: 20, minWidth: 80,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* 듣기 메뉴: 현재 읽고 있는 중이라면 '중지'로 변경하여 표시할 수도 있음 */}
                    {isBot && (
                      <button
                        type="button"
                        onClick={() => { 
                          if (isSpeakingThis) {
                            handleStopSpeak(); // 이미 읽고 있으면 완전 정지
                          } else {
                            handleSpeak(m.text, idx); 
                          }
                          setOpenMessageMenuIndex(null); 
                        }}
                        style={{
                          border: "none", borderRadius: 6, padding: "6px 10px",
                          background: "transparent", fontSize: 13, cursor: "pointer",
                          textAlign: "left", color: isSpeakingThis ? "#ef4444" : "#374151",
                        }}
                        onMouseEnter={(e) => e.target.style.background = "#f3f4f6"}
                        onMouseLeave={(e) => e.target.style.background = "transparent"}
                      >
                        {isSpeakingThis ? "⏹ 읽기 중지" : "🔊 듣기"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => { handleCopyMessage(m.text); setOpenMessageMenuIndex(null); }}
                      style={{
                        border: "none", borderRadius: 6, padding: "6px 10px",
                        background: "transparent", fontSize: 13, cursor: "pointer",
                        textAlign: "left", color: "#374151",
                      }}
                      onMouseEnter={(e) => e.target.style.background = "#f3f4f6"}
                      onMouseLeave={(e) => e.target.style.background = "transparent"}
                    >
                      📄 복사
                    </button>
                    {idx !== 0 && (
                      <button
                        type="button"
                        onClick={() => onDeleteClick(idx)}
                        style={{
                          border: "none", borderRadius: 6, padding: "6px 10px",
                          background: "transparent", fontSize: 13, cursor: "pointer",
                          textAlign: "left", color: "#ef4444",
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

      {isCurrentPending && (
        <div style={{ display: "flex", justifyContent: "flex-start", margin: "16px 0", padding: "0 8px" }}>
          <div style={{ marginRight: 8, alignSelf: "flex-start", marginTop: 4 }}>
            <div style={{
              width: 36, height: 36, borderRadius: "50%",
              background: "#e0f2fe", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18
            }}>
              🤖
            </div>
          </div>
          <div style={{
            border: "1px solid #e5e7eb", borderRadius: "4px 16px 16px 16px", padding: 4,
            maxWidth: "80%", background: "#ffffff", boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
          }}>
            <div style={{ background: "#f8fafc", borderRadius: "4px 14px 14px 14px", padding: "12px 16px", lineHeight: 1.5 }}>
              <div className="loading-main-row" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span className="loading-title" style={{ fontWeight: 600, color: "#2563eb", fontSize: "0.9rem" }}>답변 생성 중...</span>
                <span className="typing-dots"><span className="dot" /><span className="dot" /><span className="dot" /></span>
              </div>
              <div className="loading-subtext" style={{ fontSize: "0.8rem", color: "#64748b" }}>{getLoadingText()}</div>
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

export default ChatMessages;