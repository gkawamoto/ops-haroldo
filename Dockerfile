FROM node:10-alpine
RUN apk add --no-cache git openssh-client
WORKDIR /app/
VOLUME /app/scripts
COPY package.json /app/
RUN npm install
COPY index.js /app/
ENTRYPOINT ["npm"]
CMD ["start"]
