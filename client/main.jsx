import React from "react";
import { createRoot } from "react-dom/client";
import PromptLibrary from "../components/PromptLibrary.js";
import "../app/globals.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <PromptLibrary />
  </React.StrictMode>,
);
