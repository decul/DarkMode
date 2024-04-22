
class HtmlPrep {
    static addClass() {
        const fileType = this.getFileType();
        if (fileType !== null) {
            document.documentElement.setAttribute("file-type", fileType);
        }
    }

    static getFileType() {
        if (document.body?.childElementCount !== 1) {
            return null;
        }

        const child = document.body.children[0];
        const tagName = child.tagName.toUpperCase();

        switch (tagName) {
            case "IMG":
                return tagName;

            // PDF
            case "EMBED":
                if (child.getAttribute("type") === "application/pdf") {
                    return "PDF";
                }
                break;

            // JSON
            case "PRE":
                const isJson = /^{.*}$/.test(child.innerHTML);
                if (isJson) {
                    return "JSON";
                }
                break;
        }

        return null;
    }
}

HtmlPrep.addClass();
