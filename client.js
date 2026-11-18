// 公文写作助手 — 客户端：右上角“打磨稿”按钮 + 首次生成后自动打开预览
window.__ModuleLoader__.load({
  id: "gongwen-writer",
  factory(require) {
    const React = require("react");
    const h = React.createElement;

    function encodePath(path) {
      return String(path)
        .replace(/\\/g, "/")
        .split("/")
        .filter(Boolean)
        .map((part) => encodeURIComponent(part))
        .join("/");
    }

    function addressFor(sessionId, relativePath) {
      return `dsh-resource://file/session/${encodeURIComponent(sessionId)}/${encodePath(relativePath)}`;
    }

    function PreviewButton(props) {
      const { sessionId, useSessions, useResource, ctx } = props;
      const sessions = useSessions ? useSessions() : null;
      const cwd = sessions?.byId?.[sessionId]?.cwd || sessions?.sessions?.find?.((s) => s.id === sessionId)?.cwd;
      const docxAddress = cwd ? addressFor(sessionId, ".gongwen-writer/preview/当前打磨稿.docx") : "";
      const markerAddress = cwd ? addressFor(sessionId, ".gongwen-writer/preview.json") : "";
      const marker = useResource ? useResource(markerAddress) : null;
      const opened = React.useRef(false);

      const open = React.useCallback(() => {
        if (!docxAddress || !ctx.sidebarRight?.openResource) return;
        try {
          ctx.sidebarRight.openResource(docxAddress, { revealIfOpened: true });
        } catch {
          // 文件还没生成或预览类型不可用，按钮保持可用，等下一次生成。
        }
      }, [docxAddress, ctx]);

      React.useEffect(() => {
        if (!opened.current && marker?.status === "live" && docxAddress) {
          opened.current = true;
          open();
        }
      }, [marker?.status, docxAddress, open]);

      const disabled = !docxAddress;
      return h(
        "button",
        {
          type: "button",
          onClick: open,
          disabled,
          title: "打开/刷新《题目_打磨版.docx》预览；文件更新后会自动刷新",
          style: {
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            height: 24,
            padding: "0 8px",
            borderRadius: 6,
            border: "1px solid var(--dsw-alias-border-l1)",
            background: "var(--dsw-alias-bg-base)",
            color: disabled ? "var(--dsw-alias-state-idle-primary)" : "var(--dsw-alias-label-primary)",
            fontSize: 12,
            lineHeight: "22px",
            cursor: disabled ? "not-allowed" : "pointer",
            whiteSpace: "nowrap",
          },
        },
        "打磨稿",
      );
    }

    return {
      inject: ["slots"],
      apply(ctx) {
        ctx.slots.inject("conversation.session.header.actions", () =>
          ctx.slots.register(
            {
              name: "conversation.session.header.actions",
              id: "gongwen-preview",
              order: 5,
            },
            (props) => h(PreviewButton, { ...props, ctx }),
          ),
        );
      },
    };
  },
});
