import { BackroomsGame } from "./game.js";

const game = new BackroomsGame();
game.mount();

window.backrooms = game;\n\n// DEV_ADMIN_START\nif(new URLSearchParams(location.search).get("admin")==="1"){\n  import("./admin.js").then(({installAdminPanel})=>installAdminPanel(game));\n}\n// DEV_ADMIN_END
