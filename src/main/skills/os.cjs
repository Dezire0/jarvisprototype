module.exports = [
  {
    name: "os_type",
    schema: '{"action":"os_type","text":"...","reason":"..."}',
    description: "OS 접근성 권한을 사용해 텍스트 직접 입력",
    execute: async (action, { automation, safeObserve }) => {
      await automation.typeText(action.text);
      return { state: await safeObserve(), error: null };
    }
  },
  {
    name: "os_app",
    schema: '{"action":"os_app","name":"Safari","reason":"..."}',
    description: "OS 애플리케이션 실행 또는 포커스",
    execute: async (action, { automation, safeObserve }) => {
      await automation.execute({ type: "open_app", target: action.name });
      return { state: await safeObserve(), error: null };
    }
  },
  {
    name: "os_click",
    schema: '{"action":"os_click","x":100,"y":200,"reason":"..."}',
    description: "지정된 OS 화면 좌표 클릭",
    execute: async (action, { automation, safeObserve }) => {
      await automation.clickCoordinate(action.x, action.y);
      return { state: await safeObserve(), error: null };
    }
  },
  {
    name: "os_cmd",
    schema: '{"action":"os_cmd","command":"...","reason":"..."}',
    description: "OS 쉘 명령어 실행",
    execute: async (action, { automation, safeObserve }) => {
      const output = await automation.runShellCommand(action.command);
      return { state: { ...(await safeObserve()), cmd_output: output }, error: null };
    }
  }
];
