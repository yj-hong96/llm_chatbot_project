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



  // ✅ 높이 자동 조절 함수

  const autoResize = (el) => {

    if (!el) return;

    el.style.height = "auto";          // 먼저 높이 초기화

    el.style.height = el.scrollHeight + "px"; // 내용에 맞게 다시 설정

  };



  // ✅ input 값이 바뀔 때마다 항상 높이 재계산 (Alt+Enter 포함)

  useEffect(() => {

    autoResize(textareaRef.current);

  }, [input]);



  const handleChange = (e) => {

    setInput(e.target.value);

    autoResize(e.target);

  };



  return (

    <div className="chat-input-area">

      <textarea

        ref={textareaRef}

        className="chat-input"

        placeholder={

          !isOnline

            ? "오프라인 상태입니다. 인터넷 연결을 확인해 주세요."

            : isCurrentPending

            ? "응답을 기다리는 중입니다..."

            : "메시지를 입력하세요..."

        }

        value={input}

        onChange={handleChange}

        onKeyDown={handleInputKeyDown}   // Alt+Enter / Enter 로직은 ChatPage에 이미 있음

        disabled={isCurrentPending}

        onFocus={() => {

          setFocusArea("chat");

          setSelectedFolderId(null);

        }}

        rows={1}

        style={{

          resize: "none",          // 🔒 마우스로 크기 조절 금지

          overflow: "hidden",      // 스크롤바 안 보이게

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