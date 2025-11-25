import React from "react";
import { useNavigate } from "react-router-dom";

// ---------------------------------------------------------
// 홈 페이지
// ---------------------------------------------------------
function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="page home-page">
      <header className="app-header">
        <div className="logo-box" onClick={() => window.location.reload()}>
          <h1 className="logo-text">챗봇</h1>
        </div>
      </header>

      <main className="home-main">
        <div className="home-main-inner">
          <div className="hero-image">
            <img className="hero-bg" src="/img/homepage.jpg" alt="홈 배경" />
          </div>

          {/* 버튼 영역 */}
          <div className="button-group" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px', width: '100%' }}>
            
            {/* 1. 채팅 시작 버튼 -> /chat 경로 (ChatPage 실행) */}
            {/* state: { newChat: true }를 전달하여 페이지 진입 시 자동으로 새 대화를 생성하게 합니다. */}
            <button
              className="start-chat-btn"
              onClick={() => navigate("/chat", { state: { newChat: true } })}
            >
              채팅 시작 하기
            </button>

            {/* 2. 음성 시작 버튼 -> /voice 경로 (VoiceChatPage 실행) */}
            {/* 마찬가지로 state를 전달하여 음성 채팅도 새 대화로 시작하게 합니다. */}
            <button
              className="start-voice-btn"
              onClick={() => navigate("/voice", { state: { newChat: true } })}
            >
              음성 시작 하기
            </button>

          </div>
        </div>
      </main>
    </div>
  );
}

export default HomePage;