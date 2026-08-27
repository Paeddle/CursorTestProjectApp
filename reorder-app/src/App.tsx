import { BrowserRouter, Route, Routes } from 'react-router-dom'
import RequestFormPage from './pages/RequestFormPage'
import PortalPage from './pages/PortalPage'

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
      <Routes>
        <Route path="/" element={<RequestFormPage />} />
        <Route path="/r/:ipn" element={<RequestFormPage />} />
        <Route path="/portal" element={<PortalPage />} />
      </Routes>
    </BrowserRouter>
  )
}
