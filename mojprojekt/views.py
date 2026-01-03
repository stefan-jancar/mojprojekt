
from django.http import HttpResponse

def home(request):
    return HttpResponse("<h1>Vitaj na mojej stránke!</h1>")
