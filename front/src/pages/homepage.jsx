// src/pages/HomePage.jsx
import React, { useCallback } from "react";
import { useNavigate } from "react-router-dom";

// Chat / Voice 저장 키 (다른 페이지와 맞춰서 사용)
const CHAT_STORAGE_KEY = "chatConversations_v2";
const VOICE_STORAGE_KEY = "voiceConversations_v1";

// ---------------------------------------------------------
// 홈 페이지
// ---------------------------------------------------------
function HomePage() {
  const navigate = useNavigate();

  // 새 텍스트 채팅 시작
  const handleStartChat = useCallback(() => {
    try {
      // 기존 텍스트 대화 초기화
      localStorage.removeItem(CHAT_STORAGE_KEY);
    } catch (e) {
      console.error("채팅 대화 초기화 중 오류:", e);
    }

    // ChatPage로 이동
    navigate("/chat", { state: { newChat: true } });
  }, [navigate]);

  // 새 음성 채팅 시작
  const handleStartVoice = useCallback(() => {
    try {
      // ✅ 기존 음성 대화 목록을 확실하게 삭제 (이래야 목록이 비워진 상태로 시작)
      localStorage.removeItem(VOICE_STORAGE_KEY);
    } catch (e) {
      console.error("음성 대화 초기화 중 오류:", e);
    }

    // ✅ VoiceChatPage로 이동하면서 'autoPlay: true' 신호를 보냄
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