
from django.shortcuts import render, get_object_or_404
from .models import Article

def blog_list(request):
    articles = Article.objects.all().order_by('-created_at')
    return render(request, 'blog_list.html', {'articles': articles})

def blog_detail(request, article_id):
    article = get_object_or_404(Article, id=article_id)
    return render(request, 'blog_detail.html', {'article': article})
