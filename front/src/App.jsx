// 1. App.css 파일을 불러옵니다.
import './App.css';

// 2. 기존 useState, 로고 등을 모두 정리한 App 컴포넌트
function App() {
  return (
    // 3. App.css에서 사용할 className을 지정합니다.
    <div className="my-homepage-container">
      <h1>나의 반응형 홈페이지</h1>
      <p>
        이 페이지는 브라우저 창 크기에 따라 스타일이 변경됩니다.
      </p>
      <p>
        창을 768px 너비 이하로 줄여보세요. 
        제목(h1)의 색상과 크기가 바뀝니다.
      </p>
    </div>
  );
}

export default App;