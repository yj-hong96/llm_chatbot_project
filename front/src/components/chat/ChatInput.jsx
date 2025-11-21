// src/components/chat/ChatInput.jsx
import React from "react";

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
  return (
    <div className="chat-input-area">
      <input
        className="chat-input"
        type="text"
        placeholder={
          !isOnline
            ? "오프라인 상태입니다. 인터넷 연결을 확인해 주세요."
            : isCurrentPending
            ? "응답을 기다리는 중입니다..."
            : "메시지를 입력하세요..."
        }
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleInputKeyDown}
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
