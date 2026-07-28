import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import "./globals.css";

document.documentElement.classList.add("dark");

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Studio app root is missing.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
