import React from 'react'
import { createRoot } from 'react-dom/client'
import { PetWindow } from './components/PetWindow'
import './styles/tokens.css'
import './styles/app.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PetWindow />
  </React.StrictMode>,
)
