import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App';
import './vscode';

const container = document.getElementById('root');

if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
