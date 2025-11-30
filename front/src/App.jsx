// App.jsx
// =========================================================
// 메인 라우팅 설정
// - /           : HomePage
// - /chat       : ChatPage (텍스트 채팅)
// - /voice      : VoicechatPage (음성 채팅)
// =========================================================

import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./App.css";

// 페이지 컴포넌트 임포트
import HomePage from "./pages/homepage";
import ChatPage from "./pages/chatpage";
import VoicechatPage from "./pages/Voicechatpage"; // 파일명: Voicechatpage.jsx

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 홈 페이지 */}
        <Route path="/" element={<HomePage />} />

        {/* 텍스트 채팅 페이지 */}
        <Route path="/chat" element={<ChatPage />} />

        {/* 음성 채팅 페이지 */}
        <Route path="/voice" element={<VoicechatPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
