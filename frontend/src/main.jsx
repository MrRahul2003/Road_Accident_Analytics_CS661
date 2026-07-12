import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { StoreProvider } from "./data/store.jsx";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </React.StrictMode>
);
