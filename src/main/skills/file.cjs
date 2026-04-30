const fs = require('fs/promises');

module.exports = [
  {
    name: "file_read",
    schema: '{"action":"file_read","path":"/absolute/path/to/file","reason":"..."}',
    description: "[신규] 로컬 PC의 특정 파일 내용을 읽기",
    execute: async (action, { safeObserve }) => {
      try {
        const content = await fs.readFile(action.path, 'utf8');
        return { state: { ...(await safeObserve()), file_content: content.slice(0, 5000) }, error: null };
      } catch (err) {
        return { state: await safeObserve(), error: `파일 읽기 실패: ${err.message}` };
      }
    }
  },
  {
    name: "file_write",
    schema: '{"action":"file_write","path":"/absolute/path/to/file","content":"...","reason":"..."}',
    description: "[신규] 수집된 정보나 결과물을 로컬 파일로 저장",
    execute: async (action, { safeObserve }) => {
      try {
        await fs.writeFile(action.path, action.content, 'utf8');
        return { state: { ...(await safeObserve()), file_saved: true }, error: null };
      } catch (err) {
        return { state: await safeObserve(), error: `파일 쓰기 실패: ${err.message}` };
      }
    }
  }
];
