console.log("Initializing dark mode");

class ByzioDarkMode {

    static initialize() {
        this.update();
    }

    static toggle() {
        let state = !this.isEnabled();
        this.setDarkClass(state);
        this.saveEnabled(state);
    }

    static update() {
        this.setDarkClass(this.isEnabled());
    }

    static setDarkClass(state) {
        const html = document.querySelector('html');
        html.classList.toggle("byz-dark", state);
        html.toggleAttribute("byz-dark", state);
    }

    static isEnabled() {
        return localStorage.getItem("byz_dark") === "true";
    }

    static saveEnabled(state) {
        localStorage.setItem("byz_dark", state);
    }
}

ByzioDarkMode.initialize();
