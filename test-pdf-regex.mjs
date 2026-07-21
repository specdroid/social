const content = '```html\n<!DOCTYPE html>\n<html lang="en">\n<head>\n    <meta charset="UTF-8">\n    <title>Grade 9 Math Exam Answer Key</title>\n    <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>\n</head>\n<body>\n    <h1>Test</h1>\n</body>\n</html>\n```\n'
const trimmed = content.trim()
console.log('starts with ```html:', trimmed.startsWith('```html'))
console.log('ends with ```:', trimmed.endsWith('```'))
console.log('last 10 chars:', JSON.stringify(trimmed.slice(-10)))
const match = trimmed.match(/^```(?:html|HTML)\s*\n([\s\S]*?)```\s*$/)
console.log('matched:', !!match)
if (match) {
  console.log('extracted length:', match[1].trim().length)
  console.log('extracted starts with:', JSON.stringify(match[1].trim().substring(0, 50)))
}

const content2 = '```html\n<!DOCTYPE html>\n<html lang="en">\n<head>\n    <meta charset="UTF-8">\n    <title>Test</title>\n</head>\n<body>\n    <h1>Hello</h1>\n</body>\n</html>\n```'
const trimmed2 = content2.trim()
console.log('\n--- Test 2 ---')
console.log('matched2:', !!trimmed2.match(/^```(?:html|HTML)\s*\n([\s\S]*?)```\s*$/))

const content3 = '```\n<!DOCTYPE html>\n<html>\n</html>\n```'
console.log('\n--- Test 3 (no lang) ---')
console.log('matched3:', !!content3.trim().match(/^```(?:html|HTML)?\s*\n([\s\S]*?)```\s*$/))
