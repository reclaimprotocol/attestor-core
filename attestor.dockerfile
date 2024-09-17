FROM node:lts

# install git
RUN apt update -y && apt upgrade -y && apt install git -y

ARG GL_TOKEN
RUN git config --global url."https://git-push-pull:${GL_TOKEN}@gitlab.reclaimprotocol.org".insteadOf "https://gitlab.reclaimprotocol.org"

COPY ./package.json /app/
COPY ./package-lock.json /app/
RUN mkdir -p /app/src/scripts
RUN echo '' > /app/src/scripts/prepare.sh

WORKDIR /app

RUN npm i

COPY ./ /app

RUN npm run build
RUN npm run build:browser
RUN npm prune --production

CMD ["npm", "run", "start"]
EXPOSE 8001