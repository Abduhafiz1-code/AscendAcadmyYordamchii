"""FSM holatlari."""
from aiogram.fsm.state import State, StatesGroup


class Reg(StatesGroup):
    name = State()
    group = State()
    phone = State()
    code = State()


class Submit(StatesGroup):
    answer = State()


class TaskForm(StatesGroup):
    module = State()
    title = State()
    description = State()
    kind = State()
    options = State()
    answer_key = State()
    pass_score = State()
    deadline = State()
    bonus = State()
    confirm = State()


class Broadcast(StatesGroup):
    text = State()


class SettingForm(StatesGroup):
    invite_code = State()


class AdminForm(StatesGroup):
    teacher_id = State()
