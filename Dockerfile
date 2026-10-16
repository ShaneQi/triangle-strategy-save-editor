# Static Triangle Strategy save editor served by nginx. No build step: public/ is the site.
#   docker build -t ts-save-editor .
#   docker run --rm -p 8080:80 ts-save-editor
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY public/ /usr/share/nginx/html/
EXPOSE 80
