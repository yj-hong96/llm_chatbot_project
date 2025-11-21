// App.jsx
// =========================================================
// 메인/챗 라우팅 + 사이드바(폴더·채팅) + 드래그/드롭 + 모달 + 에러 처리
// (홈 화면은 변경 없음. 채팅 페이지만 개선)
// =========================================================

import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./App.css";
import HomePage from "./pages/homepage";
import ChatPage from "./pages/chatpage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/chat" element={<ChatPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
