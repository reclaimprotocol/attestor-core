FROM node:lts

# install git
RUN apt update -y && apt upgrade -y && apt install git -y

COPY ./package.json /app/
COPY ./package-lock.json /app/
RUN mkdir -p /app/src/scripts
RUN echo '' > /app/src/scripts/prepare.sh

WORKDIR /app

RUN npm i
RUN npm i koffi
COPY ./ /app

RUN npm run build
RUN npm run build:browser
RUN npm prune --production

CMD ["npm", "run", "start"]
EXPOSE 8001