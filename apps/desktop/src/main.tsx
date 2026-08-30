import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { BackendGate } from './app/BackendContext'
import { queryClient } from './app/queryClient'
import { RootErrorBoundary } from './app/RootErrorBoundary'
import { router } from './app/router'
import './styles/index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BackendGate>
          <RouterProvider router={router} />
        </BackendGate>
      </QueryClientProvider>
    </RootErrorBoundary>
  </StrictMode>,
)
