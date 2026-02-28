import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Navbar from './components/layout/Navbar';
import Compiler from './pages/Compiler';

function App() {
  return (
    <BrowserRouter>
      <div className="app-container">
        <Navbar />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Compiler />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
