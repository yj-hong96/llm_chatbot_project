// src/pages/HomePage.jsx
import React, { useCallback } from "react";
import { useNavigate } from "react-router-dom";

// 여기 키들은 지금 안 써도 되지만, 나중을 위해 남겨둘 수도 있음
const CHAT_STORAGE_KEY = "chatConversations_v2";
const VOICE_STORAGE_KEY = "voiceConversations_v1";

// ---------------------------------------------------------
// 홈 페이지
// ---------------------------------------------------------
function HomePage() {
  const navigate = useNavigate();

  // ✅ 텍스트 채팅: 기존 기록은 그대로 두고, 새 대화만 하나 더 추가
  const handleStartChat = useCallback(() => {
    // ❌ 더 이상 localStorage.removeItem(CHAT_STORAGE_KEY) 하지 않음
    //    -> ChatPage가 localStorage에서 기존 대화를 불러오고,
    //       location.state.newChat === true 이면 새 대화를 "추가"만 함.
    navigate("/chat", { state: { newChat: true } });
  }, [navigate]);

  // ✅ 음성 채팅: 기존 음성 기록도 보관 + 새 음성 대화 추가 + 자동 재생 신호
  const handleStartVoice = useCallback(() => {
    // ❌ VOICE 기록도 삭제하지 않음
    // localStorage.removeItem(VOICE_STORAGE_KEY);  // 제거

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
            {/* 1. 텍스트 채팅 시작 - 기록 유지 + 새 대화 추가 */}
            <button className="start-chat-btn" onClick={handleStartChat}>
              채팅 시작 하기
            </button>

            {/* 2. 음성 채팅 시작 - 기록 유지 + 새 대화 추가 */}
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
