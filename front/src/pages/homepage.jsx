// src/pages/HomePage.jsx
import React, { useCallback } from "react";
import { useNavigate } from "react-router-dom";

// ---------------------------------------------------------
// 홈 페이지
// ---------------------------------------------------------
function HomePage() {
  const navigate = useNavigate();

  // ✅ 텍스트 채팅: 기존 기록은 그대로 두고, 새 대화만 하나 더 추가
  const handleStartChat = useCallback(() => {
    // ChatPage에서 location.state.newChat 보고 "새 대화 하나만" 추가
    navigate("/chat", { state: { newChat: true } });
  }, [navigate]);

  // ✅ 음성 채팅:
  //  - VoiceChatPage에서 location.state.newChat 보고 새 음성 대화 추가
  const handleStartVoice = useCallback(() => {
    navigate("/voice", { state: { newChat: true, autoPlay: true } });
  }, [navigate]);

  return (
    <div className="page home-page">
      <header className="app-header">
        <div
          className="logo-box"
          onClick={() => window.location.reload()}
          style={{ cursor: "pointer" }}
        >
          <h1 className="logo-text">챗봇</h1>
        </div>
      </header>

      <main className="home-main">
        <div className="home-main-inner">
          <div className="hero-image">
            <img className="hero-bg" src="/img/homepage.jpg" alt="홈 배경" />
          </div>

          {/* 버튼 영역 */}
          <div
            className="button-group"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "15px",
              width: "100%",
            }}
          >
            {/* 1. 텍스트 채팅 시작 */}
            <button className="start-chat-btn" onClick={handleStartChat}>
              채팅 시작 하기
            </button>

            {/* 2. 음성 채팅 시작 */}
            <button className="start-voice-btn" onClick={handleStartVoice}>
              음성 시작 하기
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

export default HomePage;