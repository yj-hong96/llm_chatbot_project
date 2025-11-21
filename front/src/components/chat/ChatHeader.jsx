// src/components/chat/ChatHeader.jsx
import React from "react";

function ChatHeader({ isOnline, onClickLogo }) {
  return (
    <header className="app-header chat-header" style={{ position: "relative" }}>
      {/* 중앙: 챗봇 로고 (절대 위치로 중앙 정렬) */}
      <div
        className="logo-box"
        onClick={onClickLogo}
        style={{
          position: "absolute",
          left: "50%",
          transform: "translateX(-50%)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <h1 className="logo-text small" style={{ margin: 0 }}>
          챗봇
        </h1>
      </div>

      {/* 우측: 상태 표시 (초록색 동그라미만 표시) */}
      <div className="chat-header-status" style={{ marginLeft: "auto" }}>
        <span
          className={
            "status-dot " + (isOnline ? "status-online" : "status-offline")
          }
          aria-label={isOnline ? "온라인" : "오프라인"}
          title={isOnline ? "온라인" : "오프라인"}
        />
      </div>
    </header>
  );
}

export default ChatHeader;
