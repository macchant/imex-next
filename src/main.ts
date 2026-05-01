import "./style.css";
import { mount } from "./ui/app";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app root element");
mount(root);
