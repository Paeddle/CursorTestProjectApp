import { BrowserRouter, Route, Routes } from 'react-router-dom'
import RequestFormPage from './pages/RequestFormPage'
import PortalPage from './pages/PortalPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RequestFormPage />} />
        <Route path="/r/:ipn" element={<RequestFormPage />} />
        <Route path="/portal" element={<PortalPage />} />
      </Routes>
    </BrowserRouter>
  )
}
