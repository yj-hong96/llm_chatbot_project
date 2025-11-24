// src/components/chat/ChatInput.jsx
import React, { useRef, useEffect } from "react";

function ChatInput({
  input,
  setInput,
  handleInputKeyDown,
  sendMessage,
  isCurrentPending,
  isOnline,
  setFocusArea,
  setSelectedFolderId,
}) {
  const textareaRef = useRef(null);

  // ✅ 입력 내용이 바뀔 때마다 textarea 높이를 자동으로 조절
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    // 높이 리셋 후, 실제 내용 높이만큼 다시 지정
    el.style.height = "auto";

    const maxHeight = 200; // 필요하면 더 키우거나 줄여도 됨 (px)
    const newHeight = Math.min(el.scrollHeight, maxHeight);

    el.style.height = `${newHeight}px`;
  }, [input]);

  // ✅ Alt+Enter → 줄바꿈, 그냥 Enter → 기존 전송 로직
  const onKeyDown = (e) => {
    // Alt + Enter → 줄바꿈만
    if (e.key === "Enter" && e.altKey) {
      e.preventDefault();

      const target = e.target;
      const { selectionStart, selectionEnd, value } = target;

      const newValue =
        value.slice(0, selectionStart) + "\n" + value.slice(selectionEnd);

      setInput(newValue);

      // 커서 줄바꿈 뒤로 이동
      requestAnimationFrame(() => {
        const pos = selectionStart + 1;
        target.selectionStart = target.selectionEnd = pos;
      });

      return;
    }

    // 나머지 키(그냥 Enter 등)는 원래 handleInputKeyDown에 맡기기
    handleInputKeyDown(e);
  };

  return (
    <div className="chat-input-area">
      <textarea
        ref={textareaRef}
        className="chat-input"
        rows={1}
        placeholder={
          !isOnline
            ? "오프라인 상태입니다. 인터넷 연결을 확인해 주세요."
            : isCurrentPending
            ? "응답을 기다리는 중입니다..."
            : "메시지를 입력하세요..."
        }
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={isCurrentPending}
        onFocus={() => {
          setFocusArea("chat");
          setSelectedFolderId(null);
        }}
      />
      <button
        className="chat-send-btn"
        onClick={sendMessage}
        disabled={isCurrentPending || !isOnline}
        aria-label="메시지 전송"
      >
        <img
          src="/img/trans_message.png"
          alt="전송"
          className="send-icon"
        />
      </button>
    </div>
  );
}

export default ChatInput;
