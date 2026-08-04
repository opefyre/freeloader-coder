import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import "./globals.css";

const stored = window.localStorage.getItem("pipeline-site-theme");
const dark = stored === "dark" || (stored !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
document.documentElement.classList.toggle("dark", dark);

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Public site root is missing.");

createRoot(root).render(<StrictMode><App /></StrictMode>);
