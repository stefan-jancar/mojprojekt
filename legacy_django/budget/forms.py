
from django import forms
from .models import Income, Expense, UserProfile

class IncomeForm(forms.ModelForm):
    class Meta:
        model = Income
        fields = ['amount', 'category', 'date']

class ExpenseForm(forms.ModelForm):
    class Meta:
        model = Expense
        fields = ['amount', 'category', 'date']

class ThemeForm(forms.ModelForm):
    class Meta:
        model = UserProfile
        fields = ['theme']
        widgets = {
            'theme': forms.Select(choices=[('light', 'Svetlá'), ('dark', 'Tmavá')])
        }
