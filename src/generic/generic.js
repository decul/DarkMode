console.log("Initializing dark mode");

class ByzioDarkMode {

    static initialize() {
        this.update();
    }

    static toggle() {
        let state = !this.isEnabledLocally();
        this.setDarkClass(state);
        this.saveEnabledLocally(state);
    }

    static async update() {
        let enabledGlobally = await this.isEnabledGlobally();
        let enabledLocally = this.isEnabledLocally();
        this.setDarkClass(enabledGlobally && enabledLocally);
    }

    static setDarkClass(state) {
        const root = document.children[0];
        root.classList.toggle("byz-dark", state);
        root.toggleAttribute("byz-dark", state);
    }

    static isEnabledLocally() {
        if (location.host.endsWith("pinterest.com"))
            return true;
        return localStorage.getItem("byz_dark") === "true";
    }

    static async isEnabledGlobally() {
        let result = await ExtensionApi.storageLocalGet(["enabledGlobally"]);
        return result.enabledGlobally ?? true;
    }

    static saveEnabledLocally(state) {
        localStorage.setItem("byz_dark", state);
    }
}

ByzioDarkMode.initialize();
