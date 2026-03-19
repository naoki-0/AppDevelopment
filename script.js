const STORAGE_KEY = 'deadline-task-app.v1';
const NOTIFIED_KEY = 'deadline-task-app.notified.v1';

const form = document.getElementById('task-form');
const taskIdInput = document.getElementById('task-id');
const titleInput = document.getElementById('title');
const deadlineInput = document.getElementById('deadline');
const priorityInput = document.getElementById('priority');
const notifyInput = document.getElementById('notify');
const cancelEditButton = document.getElementById('cancel-edit');
const formTitle = document.getElementById('form-title');
const filterSelect = document.getElementById('filter');
const taskList = document.getElementById('task-list');
const summary = document.getElementById('summary');
const toastContainer = document.getElementById('toast-container');

let tasks = loadTasks();
let notifiedTaskIds = loadNotifiedTaskIds();

render();
setInterval(runNotifications, 30 * 1000);
runNotifications();

form.addEventListener('submit', (event) => {
  event.preventDefault();

  const payload = {
    id: taskIdInput.value || createId(),
    title: titleInput.value.trim(),
    deadline: toIsoDateOrNull(deadlineInput.value),
    priority: priorityInput.value,
    notifyMinutesBefore: Number(notifyInput.value),
    completed: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (!payload.title) {
    showToast('タイトルを入力してください');
    return;
  }

  if (!deadlineInput.value) {
    showToast('締め切り日時を入力してください');
    return;
  }

  if (!payload.deadline) {
    showToast('有効な締め切り日時を入力してください');
    return;
  }

  const editingId = taskIdInput.value;
  if (editingId) {
    tasks = tasks.map((task) => {
      if (task.id !== editingId) {
        return task;
      }
      return {
        ...task,
        ...payload,
        completed: task.completed,
        createdAt: task.createdAt,
      };
    });
    notifiedTaskIds.delete(editingId);
    showToast('タスクを更新しました');
  } else {
    tasks.push(payload);
    showToast('タスクを追加しました');
  }

  saveTasks();
  saveNotifiedTaskIds();
  resetForm();
  render();
});

cancelEditButton.addEventListener('click', () => resetForm());
filterSelect.addEventListener('change', render);

function loadTasks() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
}

function loadNotifiedTaskIds() {
  const raw = localStorage.getItem(NOTIFIED_KEY);
  if (!raw) {
    return new Set();
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed);
  } catch {
    return new Set();
  }
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function saveNotifiedTaskIds() {
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...notifiedTaskIds]));
}

function resetForm() {
  form.reset();
  taskIdInput.value = '';
  notifyInput.value = '60';
  priorityInput.value = 'medium';
  cancelEditButton.hidden = true;
  formTitle.textContent = 'タスクを追加';
}

function render() {
  renderSummary();
  renderTaskList();
}

function renderSummary() {
  const now = Date.now();
  const overdueCount = tasks.filter((task) => !task.completed && new Date(task.deadline).getTime() < now).length;
  const todayCount = tasks.filter((task) => isToday(task.deadline) && !task.completed).length;
  const incomplete = tasks.filter((task) => !task.completed).length;
  const completed = tasks.filter((task) => task.completed).length;

  const cards = [
    { label: '未完了', value: incomplete },
    { label: '今日のタスク', value: todayCount },
    { label: '期限切れ', value: overdueCount },
    { label: '完了済み', value: completed },
  ];

  summary.innerHTML = cards
    .map(
      (card) => `
      <div class="summary-card">
        <div class="label">${card.label}</div>
        <div class="value">${card.value}</div>
      </div>
    `,
    )
    .join('');
}

function renderTaskList() {
  const filteredTasks = applyFilter(sortTasks(tasks));

  if (filteredTasks.length === 0) {
    taskList.innerHTML = '<li class="empty">該当するタスクはありません</li>';
    return;
  }

  taskList.innerHTML = filteredTasks
    .map((task) => {
      const deadlineTime = new Date(task.deadline);
      const overdue = !task.completed && deadlineTime.getTime() < Date.now();
      const completedClass = task.completed ? 'completed' : '';

      const statusBadge = task.completed
        ? '<span class="badge">完了</span>'
        : overdue
          ? '<span class="badge overdue">期限切れ</span>'
          : '<span class="badge">未完了</span>';

      return `
        <li class="task-item" data-priority="${task.priority}">
          <div class="task-top">
            <div class="task-title ${completedClass}">${escapeHtml(task.title)}</div>
            <div class="badges">
              ${statusBadge}
              <span class="badge">${formatPriority(task.priority)}</span>
              <span class="badge">通知: ${formatNotify(task.notifyMinutesBefore)}</span>
            </div>
          </div>
          <div>締め切り: <strong>${formatDateTime(deadlineTime)}</strong></div>
          <div class="task-actions">
            <button type="button" data-action="toggle" data-id="${task.id}">${task.completed ? '未完了に戻す' : '完了にする'}</button>
            <button type="button" data-action="edit" data-id="${task.id}">編集</button>
            <button type="button" class="danger" data-action="delete" data-id="${task.id}">削除</button>
          </div>
        </li>
      `;
    })
    .join('');

  taskList.querySelectorAll('button[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const { action, id } = button.dataset;
      if (action === 'toggle') toggleTask(id);
      if (action === 'edit') startEdit(id);
      if (action === 'delete') deleteTask(id);
    });
  });
}

function sortTasks(list) {
  return [...list].sort((a, b) => {
    if (a.completed !== b.completed) {
      return a.completed ? 1 : -1;
    }
    return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
  });
}

function applyFilter(list) {
  const filter = filterSelect.value;
  const now = new Date();

  switch (filter) {
    case 'today':
      return list.filter((task) => isToday(task.deadline));
    case 'week': {
      const weekLater = new Date(now);
      weekLater.setDate(now.getDate() + 7);
      return list.filter((task) => {
        const due = new Date(task.deadline);
        return due >= startOfDay(now) && due <= weekLater;
      });
    }
    case 'overdue':
      return list.filter((task) => !task.completed && new Date(task.deadline) < now);
    case 'completed':
      return list.filter((task) => task.completed);
    case 'incomplete':
      return list.filter((task) => !task.completed);
    default:
      return list;
  }
}

function toggleTask(id) {
  tasks = tasks.map((task) => {
    if (task.id !== id) return task;
    return { ...task, completed: !task.completed, updatedAt: new Date().toISOString() };
  });
  saveTasks();
  saveNotifiedTaskIds();
  render();
}

function startEdit(id) {
  const task = tasks.find((item) => item.id === id);
  if (!task) return;

  taskIdInput.value = task.id;
  titleInput.value = task.title;
  deadlineInput.value = toLocalDateTimeInput(task.deadline);
  priorityInput.value = task.priority;
  notifyInput.value = String(task.notifyMinutesBefore);
  cancelEditButton.hidden = false;
  formTitle.textContent = 'タスクを編集';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function deleteTask(id) {
  const target = tasks.find((task) => task.id === id);
  if (!target) return;

  const ok = confirm(`「${target.title}」を削除しますか？`);
  if (!ok) return;

  tasks = tasks.filter((task) => task.id !== id);
  notifiedTaskIds.delete(id);
  saveTasks();
  saveNotifiedTaskIds();
  showToast('タスクを削除しました');
  render();
}

function runNotifications() {
  const now = Date.now();

  tasks.forEach((task) => {
    if (task.completed || task.notifyMinutesBefore <= 0) return;

    const dueTime = new Date(task.deadline).getTime();
    const notifyTime = dueTime - task.notifyMinutesBefore * 60 * 1000;

    if (now >= notifyTime && now < dueTime && !notifiedTaskIds.has(task.id)) {
      const message = `締め切り間近: ${task.title}（${formatDateTime(task.deadline)}）`;
      showToast(message);
      sendBrowserNotification('締め切り通知', message);
      notifiedTaskIds.add(task.id);
      saveNotifiedTaskIds();
    }
  });
}

function sendBrowserNotification(title, body) {
  if (!('Notification' in window)) return;

  if (Notification.permission === 'granted') {
    new Notification(title, { body });
    return;
  }

  if (Notification.permission === 'default') {
    Notification.requestPermission().then((permission) => {
      if (permission === 'granted') {
        new Notification(title, { body });
      }
    });
  }
}

function showToast(message) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  toastContainer.appendChild(node);
  setTimeout(() => node.remove(), 3800);
}

function formatDateTime(dateLike) {
  const date = new Date(dateLike);
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatPriority(priority) {
  if (priority === 'high') return '優先度: 高';
  if (priority === 'medium') return '優先度: 中';
  return '優先度: 低';
}

function formatNotify(minutes) {
  if (Number(minutes) <= 0) return 'なし';
  if (Number(minutes) >= 1440) return '1日前';
  if (Number(minutes) >= 180) return '3時間前';
  if (Number(minutes) >= 60) return '1時間前';
  return `${minutes}分前`;
}

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `task-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function toIsoDateOrNull(dateTimeValue) {
  if (!dateTimeValue) {
    return null;
  }

  const date = new Date(dateTimeValue);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function isToday(dateLike) {
  const date = new Date(dateLike);
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toLocalDateTimeInput(isoDate) {
  const date = new Date(isoDate);
  const offsetMinutes = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offsetMinutes * 60 * 1000);
  return localDate.toISOString().slice(0, 16);
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}
