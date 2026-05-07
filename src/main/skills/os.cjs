module.exports = [
  {
    name: "desktop.type",
    aliases: ["os_type"],
    inputKeys: ["text"],
    schema: '{"action":{"tool":"desktop.type","input":{"text":"..."}},"expectedOutcome":"...","isFinal":false}',
    description: "OS 접근성 권한으로 텍스트를 직접 입력합니다.",
    execute: async (action, { automation, safeObserve }) => {
      await automation.typeText(action.input.text);
      return { state: await safeObserve(), error: null };
    }
  },
  {
    name: "desktop.open_app",
    aliases: ["os_app"],
    inputKeys: ["name"],
    schema: '{"action":{"tool":"desktop.open_app","input":{"name":"Safari"}},"expectedOutcome":"...","isFinal":false}',
    description: "로컬 애플리케이션을 실행하거나 앞으로 가져옵니다.",
    execute: async (action, { automation, safeObserve }) => {
      await automation.execute({ type: "open_app", target: action.input.name });
      return { state: await safeObserve(), error: null };
    }
  },
  {
    name: "desktop.click",
    aliases: ["os_click"],
    inputKeys: ["x", "y"],
    schema: '{"action":{"tool":"desktop.click","input":{"x":100,"y":200}},"expectedOutcome":"...","isFinal":false}',
    description: "지정된 데스크톱 좌표를 클릭합니다.",
    execute: async (action, { automation, safeObserve }) => {
      await automation.clickCoordinate(action.input.x, action.input.y);
      return { state: await safeObserve(), error: null };
    }
  },
  {
    name: "shell.run",
    aliases: ["os_cmd"],
    inputKeys: ["command"],
    schema: '{"action":{"tool":"shell.run","input":{"command":"..."}},"expectedOutcome":"...","isFinal":false}',
    description: "단일 라인 셸 명령을 실행합니다.",
    execute: async (action, { automation, safeObserve }) => {
      const output = await automation.runShellCommand(action.input.command);
      return { state: { ...(await safeObserve()), cmd_output: output }, error: null };
    }
  }
];
