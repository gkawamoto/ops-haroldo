FROM node:10-alpine
WORKDIR /app/
VOLUME /app/scripts
COPY package.json /app/
RUN npm install
COPY index.js /app/
ENTRYPOINT ["npm"]
CMD ["start"]
